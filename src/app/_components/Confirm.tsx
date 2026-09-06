import { coordinateHref } from "./coordinateHref";
import { formatCoordinate } from "@/domain/coordinate";
import type { Impact } from "@/domain/types";

/** 마지막 의미 글자(닫는 괄호·따옴표 등은 건너뛴다) 기준 받침 유무 — 「보험금지급(D0003)」처럼 코드로 끝나는 라벨도 맞춘다. */
function hasBatchim(text: string): boolean {
  const ch = [...text].reverse().find((c) => /[0-9a-zA-Z가-힣]/.test(c));
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  const DIGIT_BATCHIM: Record<string, boolean> = {
    "0": true, // 영
    "1": true, // 일
    "2": false, // 이
    "3": true, // 삼
    "4": false, // 사
    "5": false, // 오
    "6": true, // 육
    "7": true, // 칠
    "8": true, // 팔
    "9": false, // 구
  };
  return DIGIT_BATCHIM[ch] ?? false;
}
const eul = (text: string) => (hasBatchim(text) ? "을" : "를");
const eun = (text: string) => (hasBatchim(text) ? "은" : "는");

/**
 * 파괴적 액션의 확인 폼 — `needsConfirmation` 이 돌려준 Impact 를 그대로 보여주고,
 * danger 버튼이 같은 액션을 `confirm:true` 로 재호출한다 (전부 서버 액션 · 서버 컴포넌트).
 *
 * 대상을 이름으로 부르려면(디자인원칙 §9.4 IKEA) 호출부가 `targetLabel`(예: 「구분자
 * 보험금지급(D0003)」)과 `actionLabel`(버튼 글자 그대로, 예: 「D0003 삭제」)을 넘긴다.
 * 아직 안 넘기는 호출부에서도 동작하도록 일반적인 문구로 대체한다.
 */
export function Confirm({
  impact,
  action,
  title,
  targetLabel,
  actionLabel,
  cancelHref,
}: {
  impact: Impact;
  /** confirm:true 로 미리 bind 된 서버 액션. */
  action: (formData: FormData) => void | Promise<void>;
  /** 명시하면 대상·문구 조합을 무시하고 그대로 쓴다 (하위 호환). */
  title?: string;
  /** 지워지는/바뀌는 대상의 표시명 — 「구분자 보험금지급(D0003)」. 있으면 제목이 대상을 이름으로 부른다. */
  targetLabel?: string;
  /** 실행 버튼 글자 그대로 — 「D0003 삭제」. 잃는 것을 가리키는 말이어야 한다(디자인원칙 §9.5). */
  actionLabel?: string;
  /** 「취소」 링크의 href. 생략하면 이 확인을 연 쿼리 파라미터를 지운 현재 경로(`?`)로 되돌아간다. */
  cancelHref?: string;
}) {
  const resolvedTitle = title ?? (targetLabel ? `${targetLabel} ${eul(targetLabel)} 삭제한다` : `${actionLabel ?? "이 작업"}${eun(actionLabel ?? "이 작업")} 되돌릴 수 없다`);
  return (
    <section className="ts-confirm">
      <p className="ts-confirm-title">{resolvedTitle}</p>
      <ul className="ts-confirm-loss">
        <li>사람이 입력한 값 {impact.valueRowsLost}건이 사라진다</li>
        {impact.cascade.length > 0 && (
          <li>
            함께 삭제된다:
            <ul>
              {impact.cascade.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </li>
        )}
        {impact.brokenRefs.length > 0 && (
          <li>
            깨질 참조 {impact.brokenRefs.length}건:
            <ul>
              {impact.brokenRefs.map((c, i) => {
                const href = coordinateHref(c);
                return (
                  <li key={i}>
                    {formatCoordinate(c, { source: true })}
                    {href && (
                      <>
                        {" "}
                        · <a href={href}>고치러 가기</a>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        )}
      </ul>
      <div className="ts-confirm-actions">
        <form action={action}>
          <button type="submit" className="danger">
            {actionLabel ?? "실행"}
          </button>
        </form>
        <a href={cancelHref ?? "?"}>취소</a>
      </div>
    </section>
  );
}
