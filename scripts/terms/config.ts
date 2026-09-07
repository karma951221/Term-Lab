/**
 * 알파Plus 실물 변환 설정 — 별표 목록(실물 번호 순) · 보통약관 · 담보약관 원문 파일과 오버레이.
 *
 * 별표 이름은 원문 본문의 참조 표기에서 얻었다. 본문이 참조하지 않는 번호(5·6·9·16~19)는 이름을 모른다 —
 * 「(미확인 별표 N)」 자리표시로 두고 실물 별표 목록을 확인하면 이름만 고친다 (코드는 불변).
 */

export interface AppendixSpec {
  number: number;
  code: string;
  name: string;
}

export const APPENDICES: AppendixSpec[] = [
  { number: 1, code: "APX01_INTEREST", name: "보험금을 지급할 때의 적립이율 계산" },
  { number: 2, code: "APX02_DISABILITY", name: "장해분류표" },
  { number: 3, code: "APX03_SURGERY_1_7", name: "1-7종 수술분류표" },
  { number: 4, code: "APX04_CANCER", name: "악성신생물(암) 분류표" },
  { number: 5, code: "APX05", name: "(미확인 별표 5)" },
  { number: 6, code: "APX06", name: "(미확인 별표 6)" },
  { number: 7, code: "APX07_STROKE", name: "뇌졸중대상질병 분류표" },
  { number: 8, code: "APX08_AMI", name: "급성심근경색증대상질병 분류표" },
  { number: 9, code: "APX09", name: "(미확인 별표 9)" },
  { number: 10, code: "APX10_LUNG", name: "말기폐질환" },
  { number: 11, code: "APX11_LIVER", name: "말기간경화" },
  { number: 12, code: "APX12_DIABETES", name: "만성당뇨합병증 분류표" },
  { number: 13, code: "APX13_BURN", name: "화상 분류표" },
  { number: 14, code: "APX14_FRACTURE_2", name: "골절(치아파절 제외)분류표 Ⅱ" },
  { number: 15, code: "APX15_MAJOR_INJURY", name: "중대한 특정상해 분류표" },
  { number: 16, code: "APX16", name: "(미확인 별표 16)" },
  { number: 17, code: "APX17", name: "(미확인 별표 17)" },
  { number: 18, code: "APX18", name: "(미확인 별표 18)" },
  { number: 19, code: "APX19", name: "(미확인 별표 19)" },
  { number: 20, code: "APX20_BENIGN_BRAIN", name: "양성 뇌종양(경계성종양제외) 대상질병 분류표" },
  { number: 21, code: "APX21_FRACTURE_TABLE_2", name: "골절분류표 Ⅱ" },
];

/** 원문 텍스트의 첫 등장을 값 슬롯으로 바꾼다 (담보 레벨 `담보명` 등). */
export interface SlotOverlay {
  /** 원문 조 번호. */
  article: string;
  find: string;
  ref: string;
}

export interface GeneralSpec {
  code: string;
  file: string;
  idPrefix: string;
  /**
   * 기본계약이 대치하는 조를 마스터에서 비울지. 비우지 않는다 — 마스터의 다른 조가 그 조의 항을 가리키므로
   * (실물 제8조 → 제4조 제4항) 편집기가 고를 id 가 있어야 하고, 조립은 순번 별칭으로 기본계약 항에 잇는다.
   */
  emptyArticles: string[];
}

export interface SpecialSpec {
  code: string;
  ownerCoverage: string;
  idPrefix: string;
  title?: string;
  /** 자기 원문 파일. */
  file?: string;
  /** 보통약관 원문에서 조를 뽑아 만드는 문서 (기본계약). `linkTo` 는 조연결할 보통약관 조 번호. */
  extractFrom?: { file: string; articles: string[]; linkTo: string[] };
  slots: SlotOverlay[];
}

export const GENERAL: GeneralSpec = { code: "alpha-general", file: "보통약관.md", idPrefix: "g", emptyArticles: [] };

export const SPECIALS: SpecialSpec[] = [
  {
    code: "base-disability80-doc",
    ownerCoverage: "base-disability80",
    idPrefix: "b",
    title: "일반상해80%이상후유장해 기본계약 문면",
    extractFrom: { file: "보통약관.md", articles: ["3", "4"], linkTo: ["3", "4"] },
    slots: [],
  },
  { code: "death-doc", ownerCoverage: "death", idPrefix: "s1", file: "일반상해사망보장.md", slots: [] },
  {
    code: "living80-doc",
    ownerCoverage: "living80",
    idPrefix: "s2",
    file: "일반상해80%이상후유장해_생활자금보장.md",
    slots: [{ article: "1", find: "일반상해80%이상후유장해 생활자금", ref: "D0001" }],
  },
  {
    code: "fracture-doc",
    ownerCoverage: "fracture",
    idPrefix: "s3",
    file: "골절(치아파절_제외)진단비Ⅱ보장.md",
    slots: [{ article: "1", find: "골절(치아파절 제외)진단비", ref: "D0001" }],
  },
];

export const FIXTURE_DIR = "tests/fixtures/terms";
export const SEED_DIR = "src/db/seed/data";
