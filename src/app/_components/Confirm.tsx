import type { Coordinate, Impact } from "@/domain/types";

function coordText(c: Coordinate): string {
  const parts = [c.document, c.ownerName ?? c.ownerId, c.articleTitle, c.refPath].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "(좌표 없음)";
}

/**
 * 파괴적 액션의 확인 폼 — `needsConfirmation` 이 돌려준 Impact 를 그대로 보여주고,
 * 「확인하고 실행」 버튼이 같은 액션을 `confirm:true` 로 재호출한다 (전부 서버 액션 · 서버 컴포넌트).
 */
export function Confirm({
  impact,
  action,
  title = "이 작업은 되돌릴 수 없습니다",
}: {
  impact: Impact;
  /** confirm:true 로 미리 bind 된 서버 액션. */
  action: (formData: FormData) => void | Promise<void>;
  title?: string;
}) {
  return (
    <div className="ts-confirm">
      <p className="ts-confirm-title">{title}</p>
      <ul className="ts-confirm-body">
        <li>소실될 값 행: {impact.valueRowsLost}건</li>
        {impact.cascade.length > 0 && (
          <li>
            함께 삭제됨:
            <ul>
              {impact.cascade.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </li>
        )}
        {impact.brokenRefs.length > 0 && (
          <li>
            깨질 참조 ({impact.brokenRefs.length}건):
            <ul>
              {impact.brokenRefs.map((c, i) => (
                <li key={i}>{coordText(c)}</li>
              ))}
            </ul>
          </li>
        )}
      </ul>
      <form action={action} className="ts-confirm-actions">
        <button type="submit" className="danger">
          확인하고 실행
        </button>
      </form>
    </div>
  );
}
