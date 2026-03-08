require("dotenv").config();
const { startServer } = require("./index");
const port = Number(process.env.PORT) || 3000;
startServer(port).catch((err) => {
  console.error(err);
  process.exit(1);
});
