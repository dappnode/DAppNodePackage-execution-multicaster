import fastify from "fastify";
import replyFrom from "@fastify/reply-from";
import fastifyjwt from "@fastify/jwt";
import jwt from "jsonwebtoken";
import { ExecutionClientEngine, ExecutionSyncStatus } from "./types";

const MULTICASTER_JWT =
  process.env.JWT ||
  "7ad9cfdec75eceb662f5e48f5765701c17f51a5233a60fbcfa5f9e495fa99d18";
const PORT = parseInt(process.env.PORT || "8551");

export default async function startServer(
  executionClients: ExecutionClientEngine[]
) {
  const proxy = fastify();
  proxy.register(replyFrom);
  proxy.register(fastifyjwt, {
    secret: MULTICASTER_JWT,
  });

  const topPriorityECName = executionClients.reduce((min, ec) =>
    min.priority < ec.priority ? min : ec
  ).name;

  //    proxy.addHook("onRequest", async (request, reply) => {
  //        try {
  //            await request.jwtVerify()
  //        } catch (err) {
  //            reply.send(err)
  //        }
  //    })

  proxy.post("/", (request, reply) => {
    const syncedECs = executionClients.filter(
      (ec) => ec.status === ExecutionSyncStatus.Synced
    );
    const syncingECs = executionClients.filter(
      (ec) => ec.status === ExecutionSyncStatus.Syncing
    );

    let priorityEC: ExecutionClientEngine;

    // get main EC from synced list, if not possible, try synicng list
    if (syncedECs.length !== 0) {
      priorityEC = syncedECs.reduce((min, ec) =>
        min.priority < ec.priority ? min : ec
      );
    } else {
      if (syncingECs.length !== 0) {
        priorityEC = syncingECs.reduce((min, ec) =>
          min.priority < ec.priority ? min : ec
        );
      } else {
        reply.code(500).send("No execution engine available");
        console.warn("No execution engine available");
        return;
      }
    }

    if (topPriorityECName !== priorityEC.name)
      console.warn(
        `${topPriorityECName} is execution engine with top priority but it is unsynced or unavailable.`
      );

    // forward all trafic to main EC with its jwt
    reply.from(priorityEC.url, {
      rewriteRequestHeaders: (originalReq, headers) => {
        return {
          ...headers,
          authorization:
            "Bearer " +
            jwt.sign(
              { iat: Math.floor(Date.now() / 1000) },
              priorityEC.jwtsecret
            ),
        };
      },
    });

    console.log(
      `--------\nHandled ${(<any>request.body).method} by forwarding it to ${
        priorityEC.name
      }`
    );

    const [group, method]: string[] = (<any>request.body).method.split("_");
    if (group !== "engine" || method === "getPayloadV1") return; // only engine routes that are not getPayloadV1 we multiplex. Ideally, we would check here for forkChoiceUpdatedV1 and drop payloadAttributes

    const ECs = syncedECs
      .concat(syncingECs)
      .filter((ec) => ec.name !== priorityEC.name);

    for (const ec of ECs) {
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
      `Multicasted ${(<any>request.body).method} to:`,
      ECs.map((x) => x.name).reduce((prev, curr) => prev + " " + curr, "")
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
