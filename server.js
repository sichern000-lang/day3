// 실행: ANTHROPIC_API_KEY=... node server.js  →  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const { toolDefinitions, toolHandlers } = require("./api/tools");

const MODEL = "claude-sonnet-5-5";
const spots = JSON.parse(fs.readFileSync(path.join(__dirname, "jeju_spots.json"), "utf8")).spots;
const coords = Object.fromEntries(spots.map((s) => [s.name, { lat: s.lat, lon: s.lon }]));

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: "제주 여행 도우미. 장소는 반드시 find_spots 도구 결과에서만 골라 안내한다.",
      tools: toolDefinitions,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return res.json();
}

// 사용자 문장 → Claude 가 find_spots 호출 → 결과 장소에 좌표를 붙여 지도용으로 반환
async function chat(message) {
  const messages = [{ role: "user", content: message }];
  const found = new Map();
  for (let turn = 0; turn < 5; turn++) {
    const reply = await callClaude(messages);
    messages.push({ role: "assistant", content: reply.content });
    if (reply.stop_reason !== "tool_use") {
      const text = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return { reply: text, spots: [...found.values()] };
    }
    const results = reply.content
      .filter((b) => b.type === "tool_use")
      .map((b) => {
        const out = toolHandlers[b.name](b.input);
        if (Array.isArray(out)) out.forEach((s) => found.set(s.name, { ...s, ...coords[s.name] }));
        return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) };
      });
    messages.push({ role: "user", content: results });
  }
  return { reply: "도구 호출이 너무 많아 중단했어요.", spots: [...found.values()] };
}

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
