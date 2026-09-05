import { fixtureServer } from "./app.js";
const { server } = fixtureServer();
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "Synthetic fixture listening on port " + (process.env.PORT || 3000),
    ),
);
