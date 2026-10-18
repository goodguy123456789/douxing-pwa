import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { httpLoggingOptions, privateErrorHandler } from "./lib/http-logging";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    ...httpLoggingOptions,
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(privateErrorHandler);

export default app;
