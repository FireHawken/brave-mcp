import { parseArgs } from "node:util";

import { createDaemonApp } from "./app.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      host: {
        type: "string",
        default: "127.0.0.1",
      },
      port: {
        type: "string",
        default: "39200",
      },
      "config-dir": {
        type: "string",
      },
      silent: {
        type: "boolean",
        default: false,
      },
    },
  });

  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${values.port}`);
  }

  const options = {
    logger: !values.silent,
    ...(values["config-dir"] ? { configDir: values["config-dir"] } : {}),
  };

  const { app } = await createDaemonApp(options);

  await app.listen({
    host: values.host,
    port,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
