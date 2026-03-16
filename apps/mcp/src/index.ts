import { runStdioServer } from "./server.js";

runStdioServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

