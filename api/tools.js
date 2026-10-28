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
];

const toolHandlers = { find_spots };

module.exports = { find_spots, toolDefinitions, toolHandlers };
