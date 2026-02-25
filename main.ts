import { Plugin, Notice, Editor, MarkdownView } from "obsidian";

// 라인 유형 정의
enum LineType {
  HEADING,       // 편, 장, 절, 관, 부칙
  ARTICLE_START, // 제X조
  HO,            // 1. 2. 8의2. (호)
  MOK,           // 가. 나. 다. (목)
  EMPTY,
  CONTENT,       // 기타 (항, 일반 텍스트 등)
}

interface ParsedLine {
  type: LineType;
  raw: string;
}

export default class LegalFormatPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "format-legal-text",
      name: "법률 조문 포맷 (Format Legal Text)",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const content = editor.getValue();
        const formatted = formatLegalText(content);
        editor.setValue(formatted);
        new Notice("법률 조문 포맷 완료!");
      },
    });

    this.addCommand({
      id: "format-legal-text-clean",
      name: "법률 조문 포맷 - Clean (Format Legal Text - Clean)",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const content = editor.getValue();
        const formatted = formatLegalText(cleanAnnotations(content));
        editor.setValue(formatted);
        new Notice("법률 조문 포맷 (Clean) 완료!");
      },
    });
  }
}

/**
 * 라인의 유형을 판별
 */
function classifyLine(line: string): LineType {
  const trimmed = line.trim();

  if (trimmed === "") return LineType.EMPTY;

  // 편/장/절/관/부칙 heading
  if (
    /^제\d+편(\s|$)/.test(trimmed) ||
    /^제\d+장(\s|$)/.test(trimmed) ||
    /^제\d+절(\s|$)/.test(trimmed) ||
    /^제\d+관(\s|$)/.test(trimmed) ||
    /^부칙/.test(trimmed)
  ) {
    return LineType.HEADING;
  }

  // 제X조 또는 제X조의Y
  if (/^제\d+조(?:의\d+)?/.test(trimmed)) {
    return LineType.ARTICLE_START;
  }

  // 호: 숫자. 또는 숫자의숫자. 으로 시작 (공백 없이 바로 문장이 올 수 있음)
  if (/^\d+(?:의\d+)?\./.test(trimmed)) {
    return LineType.HO;
  }

  // 목: 가. 나. 다. 등 한글 한 글자 + . 으로 시작 (공백 없이 바로 문장이 올 수 있음)
  if (/^[가-힣]\./.test(trimmed)) {
    return LineType.MOK;
  }

  return LineType.CONTENT;
}

/**
 * heading 레벨 결정
 *   편 → h1, 장 → h2, 절 → h3, 관 → h4, 부칙 → h2
 */
function formatHeading(line: string): string {
  const trimmed = line.trim();
  if (/^제\d+편/.test(trimmed)) return `# ${trimmed}`;
  if (/^제\d+장/.test(trimmed)) return `## ${trimmed}`;
  if (/^제\d+절/.test(trimmed)) return `### ${trimmed}`;
  if (/^제\d+관/.test(trimmed)) return `#### ${trimmed}`;
  if (/^부칙/.test(trimmed)) return `## ${trimmed}`;
  return trimmed;
}

/**
 * 조문번호와 표제를 bold 처리
 *   제1조(목적) → **제1조(목적)**
 *   제1조       → **제1조**
 *   제1조의2(특례) → **제1조의2(특례)**
 */
function boldArticle(line: string): string {
  return line.replace(
    /^(제\d+조(?:의\d+)?(?:\([^)]*\))?)/,
    "**$1**"
  );
}

/**
 * 호 번호를 inline code 처리
 *   1. 내용 → `1.` 내용
 *   8의2. 내용 → `8의2.` 내용
 *   1.내용 → `1.` 내용
 */
function formatHo(line: string): string {
  return line.replace(/^(\d+(?:의\d+)?)\.\s*/, "`$1.` ");
}

/**
 * 목 번호를 inline code 처리
 *   가. 내용 → `가.` 내용
 *   가.내용 → `가.` 내용
 */
function formatMok(line: string): string {
  return line.replace(/^([가-힣])\.\s*/, "`$1.` ");
}

/**
 * 라인의 인라인 포맷을 적용 (bold, inline code 등)
 */
/**
 * 항 번호(①②③...) 뒤에 공백이 없으면 삽입
 *   ③제1항 → ③ 제1항
 */
function insertHangSpace(line: string): string {
  return line.replace(/([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])(?=\S)/g, "$1 ");
}

/**
 * 라인의 인라인 포맷을 적용 (bold, inline code, 항 공백 등)
 */
function formatInline(line: string, type: LineType): string {
  const trimmed = line.trim();
  let result: string;
  switch (type) {
    case LineType.ARTICLE_START:
      result = boldArticle(trimmed);
      break;
    case LineType.HO:
      result = formatHo(trimmed);
      break;
    case LineType.MOK:
      result = formatMok(trimmed);
      break;
    default:
      result = trimmed;
  }
  return insertHangSpace(result);
}

/**
 * 법조문 외의 주석/메타정보를 제거 (Clean 버전)
 *
 * 제거 대상:
 *   - <개정 ...>, <신설 ...>, <삭제 ...> 등 angle bracket 주석
 *   - [본조신설 ...], [전문개정 ...], [제목개정 ...] 등 bracket 주석
 *   - [시행일: ...] 제2조 와 같은 시행일 메타 라인 전체
 *   - [시행 ...] [법률 ...] 등 상단 메타정보 라인 전체
 */
function cleanAnnotations(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      // 라인 전체가 메타정보인 경우 제거
      // [시행...], [법률...], [대통령령...] 으로 시작하는 라인
      // 예: [시행일: 2026. 5. 11.] 제2조부터 제5조까지
      // 예: [시행 2024.1.18.] [법률 제19898호, 2024.1.16., 일부개정]
      if (/^\[시행/.test(trimmed)) return "";
      if (/^\[법률/.test(trimmed)) return "";
      if (/^\[대통령령/.test(trimmed)) return "";
      if (/^\[총리령/.test(trimmed)) return "";
      if (/^\[부령/.test(trimmed)) return "";

      // 인라인 <...> 주석 제거
      let cleaned = line.replace(/<[^>]*>/g, "");

      // 인라인 [...] 주석 제거
      cleaned = cleaned.replace(/\[[^\]]*\]/g, "");

      return cleaned;
    })
    .join("\n");
}

/**
 * 전체 법률 텍스트를 포맷
 */
function formatLegalText(text: string): string {
  // 빈 줄 제거 (복사/붙여넣기로 인한 불필요한 빈 줄 정리)
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const parsed: ParsedLine[] = lines.map((line) => ({
    type: classifyLine(line),
    raw: line,
  }));

  const result: string[] = [];
  let inArticle = false;

  for (let i = 0; i < parsed.length; i++) {
    const { type, raw } = parsed[i];
    const trimmed = raw.trim();

    // ── HEADING ──
    if (type === LineType.HEADING) {
      if (inArticle) {
        // 이전 blockquote 종료 (빈 줄 삽입)
        result.push("");
        inArticle = false;
      }
      result.push(formatHeading(trimmed));
      result.push("");
      continue;
    }

    // ── ARTICLE START (새 조) ──
    if (type === LineType.ARTICLE_START) {
      if (inArticle) {
        // 이전 blockquote 종료
        result.push("");
      }
      inArticle = true;
      result.push(`> ${formatInline(trimmed, type)}`);
      continue;
    }

    // ── EMPTY LINE ──
    if (type === LineType.EMPTY) {
      if (inArticle) {
        // 다음 비어있지 않은 라인을 확인하여 같은 조 안인지 판단
        const nextType = findNextNonEmptyType(parsed, i + 1);
        if (
          nextType !== null &&
          nextType !== LineType.ARTICLE_START &&
          nextType !== LineType.HEADING
        ) {
          // 같은 조 내부 → blockquote 유지
          result.push(">");
        } else {
          // 조가 끝남
          result.push("");
          inArticle = false;
        }
      } else {
        result.push("");
      }
      continue;
    }

    // ── HO / MOK / CONTENT (조 내부 또는 외부) ──
    if (inArticle) {
      result.push(`> ${formatInline(trimmed, type)}`);
    } else {
      // 조 밖의 콘텐츠는 그대로
      result.push(formatInline(trimmed, type));
    }
  }

  return result.join("\n");
}

/**
 * idx부터 다음 비어있지 않은 라인의 타입을 반환
 */
function findNextNonEmptyType(
  parsed: ParsedLine[],
  idx: number
): LineType | null {
  for (let j = idx; j < parsed.length; j++) {
    if (parsed[j].type !== LineType.EMPTY) {
      return parsed[j].type;
    }
  }
  return null;
}
