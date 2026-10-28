const fs = require("fs");
const path = require("path");
const { toolDefinitions, toolHandlers } = require("./tools");

const MODEL = "claude-sonnet-5-5";
const spots = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "jeju_spots.json"), "utf8")).spots;
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
      system: "제주 여행 추천 에이전트. 사용자의 요청에서 지역을 파악해 get_weather 로 날씨를 먼저 확인하고, 비·강수확률이 높으면 실내, 맑으면 야외 위주로 find_spots 를 호출해 장소를 고른다. 장소는 반드시 find_spots 결과에서만 추천하고, 날씨를 근거로 이유를 짧게 설명한다. 지역이 불분명하면 되묻는다.",
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
  const weather = new Map();
  const steps = []; // 에이전트가 부른 도구 기록
  for (let turn = 0; turn < 5; turn++) {
    const reply = await callClaude(messages);
    messages.push({ role: "assistant", content: reply.content });
    if (reply.stop_reason !== "tool_use") {
      const text = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return { reply: text, spots: [...found.values()], weather: [...weather.values()], steps };
    }
    const results = [];
    for (const b of reply.content.filter((b) => b.type === "tool_use")) {
      steps.push(`${b.name}(${JSON.stringify(b.input)})`);
      const out = await toolHandlers[b.name](b.input);
      if (Array.isArray(out)) out.forEach((s) => found.set(s.name, { ...s, ...coords[s.name] }));
      else if (out.weather) weather.set(out.area, out);
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "도구 호출이 너무 많아 중단했어요.", spots: [...found.values()], weather: [...weather.values()], steps };
}


// Vercel 서버리스 함수: POST /api/chat { message }
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    res.status(200).json(await chat(req.body.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
module.exports.chat = chat;
