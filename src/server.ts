import fastify, { FastifyRequest } from "fastify";
import replyFrom from "@fastify/reply-from";
import fastifyjwt from "@fastify/jwt";
import jwt from "jsonwebtoken";
import { ExecutionClientEngine, ExecutionSyncStatus } from "./types";

const MULTICASTER_JWT = Buffer.from(
  process.env.JWT ||
    "7ad9cfdec75eceb662f5e48f5765701c17f51a5233a60fbcfa5f9e495fa99d18",
  "hex"
);
const PORT = parseInt(process.env.PORT || "8551");

function getPriorityExecutionClient(executionClients: ExecutionClientEngine[]) {
  if (executionClients.length === 0) return undefined;
  return executionClients.reduce((min, ec) =>
    min.priority < ec.priority ? min : ec
  );
}

export default async function startServer(
  executionClients: ExecutionClientEngine[]
) {
  if (executionClients.length === 0) {
    throw new Error("Server cannot be initialized without execution clients");
  }
  const proxy = fastify({
    bodyLimit: 10485760, // 10 MiB
    logger: (process.env.PROXY_LOGGER ?? "false") === "true",
  });
  proxy.register(replyFrom);
  proxy.register(fastifyjwt, {
    secret: MULTICASTER_JWT,
  });

  const topPriorityExecutionClientName = (
    getPriorityExecutionClient(executionClients) as ExecutionClientEngine
  ).name; // safe since it is only undefined for executionClients.length === 0

  //    proxy.addHook("onRequest", async (request, reply) => {
  //        try {
  //            await request.jwtVerify()
  //        } catch (err) {
  //            reply.send(err)
  //        }
  //    })

  proxy.post("/", (request, reply) => {
    // Both engine_newPayload and enigne_forkChoiceUpdatedV1 can be used to update syncing status of execution clients, 
    // it seems to me that it is better to do it asynchronously and less often.
    const syncedExecutionClients = executionClients.filter(
      (ec) => ec.status === ExecutionSyncStatus.Synced
    );
    const syncingExecutionClients = executionClients.filter(
      (ec) => ec.status === ExecutionSyncStatus.Syncing
    );

    // get main Execution client from synced list, if not possible, try synicng list
    const priorityExecutionClient =
      getPriorityExecutionClient(syncedExecutionClients) ??
      getPriorityExecutionClient(syncingExecutionClients);

    if (!priorityExecutionClient) {
      reply.code(500).send("No execution engine available");
      console.warn("No execution engine available");
      return;
    }

    if (topPriorityExecutionClientName !== priorityExecutionClient.name)
      console.warn(
        `${topPriorityExecutionClientName} is execution engine with top priority but it is unsynced or unavailable.`
      );

    // forward all trafic to main EC with its jwt
    reply.from(priorityExecutionClient.url, {
      rewriteRequestHeaders: (originalReq, headers) => {
        return {
          ...headers,
          authorization:
            "Bearer " +
            jwt.sign(
              { iat: Math.floor(Date.now() / 1000) },
              priorityExecutionClient.jwtsecret
            ),
        };
      },
    });

    const method = (request.body as FastifyRequest).method;

    console.log(
      `--------\nHandled ${method} by forwarding it to ${priorityExecutionClient.name}`
    );

    const [mod, call] = method.split("_");
    if (mod !== "engine" || call === "getPayloadV1") return; // only engine routes that are not getPayloadV1 we multicast. Ideally, we would check for forkChoiceUpdatedV1 and drop payloadAttributes

    const executionToMulticast = syncedExecutionClients
      .concat(syncingExecutionClients)
      .filter((ec) => ec.name !== priorityExecutionClient.name);

    for (const ec of executionToMulticast) {
      reply.from(ec.url, {
        onResponse: (request, reply, res) => {
          reply.removeHeader("content-length"); // don't care for response of other EC, just remove content-length they may set
        },
        rewriteRequestHeaders: (originalReq, headers) => {
          // add custom jwt for every client
          return {
            ...headers,
            authorization:
              "Bearer " +
              jwt.sign({ iat: Math.floor(Date.now() / 1000) }, ec.jwtsecret),
          };
        },
      });
    }

    console.log(
      `Multicasted ${method} to: ${executionToMulticast
        .map((x) => x.name)
        .join(" ")}`
    );
  });

  proxy.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  });
}
