const fs = require("fs");
const path = require("path");
const { toolDefinitions, toolHandlers } = require("./tools");

// 앞 모델이 과부하(503/429)이거나 없으면(404) 다음 모델로 넘어간다
const MODELS = ["gemini-3.8-flash", "gemini-flash-latest"];
const SYSTEM =
  "제주 여행 추천 에이전트. 요청에서 지역을 파악하면 get_weather 와 find_spots(area만, indoor는 생략)를 반드시 한 번에 동시에 호출한다. " +
  "결과를 받으면 도구를 더 부르지 말고, 날씨(비·강수확률 높음→실내, 맑음→야외 위주)를 근거로 find_spots 결과 중에서만 3곳 안팎을 짧게 추천한다. 지역이 불분명하면 되묻는다.";

const spots = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "jeju_spots.json"), "utf8")).spots;
const coords = Object.fromEntries(spots.map((s) => [s.name, { lat: s.lat, lon: s.lon }]));

// tools.js 의 도구 설명(name · description · input_schema)을 Gemini functionDeclarations 로 바꾼다
const functionDeclarations = toolDefinitions.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));

async function callGemini(contents) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    tools: [{ functionDeclarations }],
    contents,
    generationConfig: { maxOutputTokens: 800 },
  });
  let lastError;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const out = await res.json();
        out.ms = Date.now() - t0;
        out.model = model;
        return out;
      }
      lastError = new Error(`Gemini API ${res.status} (${model}): ${await res.text()}`);
      if (res.status === 404) break; // 이 모델은 쓸 수 없음 → 다음 모델
      if (res.status !== 503 && res.status !== 429) throw lastError;
      await new Promise((r) => setTimeout(r, 1000)); // 과부하: 잠깐 쉬고 재시도
    }
  }
  throw lastError;
}

// 사용자 문장 → Gemini 가 get_weather · find_spots 호출 → 결과 장소에 좌표를 붙여 지도용으로 반환
async function chat(message) {
  const contents = [{ role: "user", parts: [{ text: message }] }];
  const found = new Map();
  const weather = new Map();
  const steps = []; // 에이전트가 부른 도구 기록
  const done = (reply) => ({ reply, spots: [...found.values()], weather: [...weather.values()], steps });

  for (let turn = 0; turn < 5; turn++) {
    const g = await callGemini(contents);
    steps.push(`⏱ ${g.model} ${g.ms}ms`);
    const content = g.candidates?.[0]?.content;
    if (!content) return done("응답을 받지 못했어요. 다시 시도해 주세요.");
    contents.push(content);
    const calls = content.parts.filter((p) => p.functionCall);
    if (!calls.length) return done(content.parts.map((p) => p.text || "").join(""));

    // 같은 턴에 요청된 도구는 동시에 실행한다
    const responses = await Promise.all(
      calls.map(async ({ functionCall: c }) => {
        steps.push(`${c.name}(${JSON.stringify(c.args)})`);
        const out = await toolHandlers[c.name](c.args);
        if (Array.isArray(out)) out.forEach((s) => found.set(s.name, { ...s, ...coords[s.name] }));
        else if (out.weather) weather.set(out.area, out);
        return { functionResponse: { name: c.name, response: { result: out } } };
      })
    );
    contents.push({ role: "user", parts: responses });
  }
  return done("도구 호출이 너무 많아 중단했어요.");
}

// Gemini 가 과부하일 때: 문장에서 지역을 찾아 도구를 직접 호출하고 날씨 기준으로 골라 답한다
async function fallbackChat(message, reason) {
  const area = ["동쪽", "서쪽", "서귀포", "제주시"].find((a) => message.includes(a));
  if (!area) throw new Error(reason);
  const [w, list] = await Promise.all([toolHandlers.get_weather({ area }), toolHandlers.find_spots({ area })]);
  const rainy = !w.error && (w.rain_probability_percent >= 50 || w.precipitation_mm > 0);
  const picked = (list.filter((s) => s.indoor === rainy).length ? list.filter((s) => s.indoor === rainy) : list).slice(0, 4);
  const head = w.error
    ? `날씨를 확인하지 못해 ${area} 관광지를 보여드려요.`
    : `${area}은 ${w.weather}, ${w.temperature_c}°C, 강수확률 ${w.rain_probability_percent}%라서 ${rainy ? "실내" : "야외"} 위주로 골랐어요.`;
  return {
    reply: `${head}\n\n` + picked.map((s) => `• ${s.name} — ${s.desc}`).join("\n") + "\n\n(AI 모델이 혼잡해 규칙 기반으로 추천했어요.)",
    spots: picked.map((s) => ({ ...s, ...coords[s.name] })),
    weather: w.error ? [] : [w],
    steps: [`⚠️ Gemini 사용 불가 → 직접 도구 호출: get_weather("${area}"), find_spots("${area}")`],
  };
}

// Vercel 서버리스 함수: POST /api/chat { message }
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const message = req.body.message;
    res.status(200).json(await chat(message).catch((e) => fallbackChat(message, e.message)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
module.exports.chat = chat;
