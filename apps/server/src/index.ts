import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp({ logger: true });

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`화롯가 서버가 촛불을 켰다 — :${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
