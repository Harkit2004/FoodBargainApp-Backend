import app from "./app.js";

// Get the desired port from the process' environment. Default to `8080`
const port = parseInt(process.env.PORT || "8080", 10);

// Start a server listening on this port
const server = app.listen(port, () => {
  // Log a message that the server has started, and which port it's using.
  console.log(`Server started on port ${port}`);
});

export default server;
