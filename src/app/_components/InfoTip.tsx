import { IconInfo } from "./icons";

export function InfoTip({ text }: { text: string }) {
  return <span className="ts-infotip" title={text} aria-label={text}><IconInfo /></span>;
}
