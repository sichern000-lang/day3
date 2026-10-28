const fs = require("fs");
const path = require("path");

const AREAS = ["동쪽", "서쪽", "서귀포", "제주시"];
const MAX_SPOTS = 8;

const loadSpots = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "jeju_spots.json"), "utf8")).spots;

// jeju_spots.json 의 spot 은 area(문자열) 를 갖고 있어 areas(배열)로 내보낸다. 좌표는 뺀다.
function find_spots({ area, indoor } = {}) {
  if (!AREAS.includes(area)) {
    return { error: `area 는 ${AREAS.join(" · ")} 중 하나여야 합니다.` };
  }
  return loadSpots()
    .filter((s) => s.area === area && (indoor === undefined || s.indoor === indoor))
    .slice(0, MAX_SPOTS)
    .map((s) => ({ name: s.name, areas: [s.area], indoor: s.indoor, desc: s.desc }));
}

// OpenWeather(OPENWEATHER_API_KEY)로 지역 중심 좌표의 현재 날씨와 앞으로 12시간 강수확률을 가져온다.
async function get_weather({ area } = {}) {
  if (!AREAS.includes(area)) {
    return { error: `area 는 ${AREAS.join(" · ")} 중 하나여야 합니다.` };
  }
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return { error: "OPENWEATHER_API_KEY 가 설정되지 않았습니다." };
  const [lat, lon] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "jeju_spots.json"), "utf8")).areas[area];
  const q = `lat=${lat}&lon=${lon}&units=metric&lang=kr&appid=${key}`;
  const [now, next] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?${q}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?${q}&cnt=4`),
  ]);
  if (!now.ok || !next.ok) return { error: `날씨 조회 실패 (${now.status}/${next.status})` };
  const c = await now.json();
  const f = await next.json();
  return {
    area,
    weather: c.weather[0].description,
    temperature_c: c.main.temp,
    precipitation_mm: (c.rain && c.rain["1h"]) || 0,
    wind_ms: c.wind.speed,
    rain_probability_percent: Math.round(Math.max(...f.list.map((x) => x.pop)) * 100),
  };
}

const toolDefinitions = [
  {
    name: "find_spots",
    description:
      "제주 관광지 목록(jeju_spots.json)에서 지역과 실내 여부로 장소를 골라 최대 8곳의 이름·지역·실내 여부·설명을 돌려준다. " +
      "목록 밖 장소는 없다. 결과에 없는 장소는 추천하거나 지어내지 말고, 결과가 비면 조건에 맞는 곳이 목록에 없다고 답한다.",
    input_schema: {
      type: "object",
      properties: {
        area: { type: "string", enum: AREAS, description: "찾을 지역" },
        indoor: { type: "boolean", description: "true 면 실내만, false 면 야외만. 생략하면 모두." },
      },
      required: ["area"],
    },
  },
  {
    name: "get_weather",
    description:
      "제주 지역(동쪽·서쪽·서귀포·제주시)의 현재 날씨, 기온, 강수량, 바람, 앞으로 12시간 내 최대 강수확률을 조회한다. " +
      "비가 오거나 올 가능성이 높으면 실내, 맑으면 야외 장소를 고르는 근거로 쓴다.",
    input_schema: {
      type: "object",
      properties: { area: { type: "string", enum: AREAS, description: "날씨를 볼 지역" } },
      required: ["area"],
    },
  },
];

const toolHandlers = { find_spots, get_weather };

module.exports = { find_spots, get_weather, toolDefinitions, toolHandlers };
