// 로컬 실행: GEMINI_API_KEY=... OPENWEATHER_API_KEY=... node server.js  →  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chat } = require("./api/chat");

http
  .createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/chat") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const out = await chat(JSON.parse(body).message);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(__dirname, "index.html")));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(3000, () => console.log("http://localhost:3000"));
