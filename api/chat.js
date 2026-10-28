const fs = require("fs");
const path = require("path");
const { toolDefinitions, toolHandlers } = require("./tools");

const MODEL = "gemini-2.5-flash";
const SYSTEM =
  "제주 여행 추천 에이전트. 사용자의 요청에서 지역을 파악해 get_weather 로 날씨를 먼저 확인하고, 비·강수확률이 높으면 실내, 맑으면 야외 위주로 find_spots 를 호출해 장소를 고른다. 장소는 반드시 find_spots 결과에서만 추천하고, 날씨를 근거로 이유를 짧게 설명한다. 지역이 불분명하면 되묻는다.";

const spots = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "jeju_spots.json"), "utf8")).spots;
const coords = Object.fromEntries(spots.map((s) => [s.name, { lat: s.lat, lon: s.lon }]));

// tools.js 의 도구 설명(name · description · input_schema)을 Gemini functionDeclarations 로 바꾼다
const functionDeclarations = toolDefinitions.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));

async function callGemini(contents) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: [{ functionDeclarations }],
        contents,
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  return res.json();
}

// 사용자 문장 → Gemini 가 get_weather · find_spots 호출 → 결과 장소에 좌표를 붙여 지도용으로 반환
async function chat(message) {
  const contents = [{ role: "user", parts: [{ text: message }] }];
  const found = new Map();
  const weather = new Map();
  const steps = []; // 에이전트가 부른 도구 기록
  const done = (reply) => ({ reply, spots: [...found.values()], weather: [...weather.values()], steps });

  for (let turn = 0; turn < 5; turn++) {
    const content = (await callGemini(contents)).candidates?.[0]?.content;
    if (!content) return done("응답을 받지 못했어요. 다시 시도해 주세요.");
    contents.push(content);
    const calls = content.parts.filter((p) => p.functionCall);
    if (!calls.length) return done(content.parts.map((p) => p.text || "").join(""));

    const responses = [];
    for (const { functionCall: c } of calls) {
      steps.push(`${c.name}(${JSON.stringify(c.args)})`);
      const out = await toolHandlers[c.name](c.args);
      if (Array.isArray(out)) out.forEach((s) => found.set(s.name, { ...s, ...coords[s.name] }));
      else if (out.weather) weather.set(out.area, out);
      responses.push({ functionResponse: { name: c.name, response: { result: out } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return done("도구 호출이 너무 많아 중단했어요.");
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
