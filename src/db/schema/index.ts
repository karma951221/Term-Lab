/**
 * Drizzle 스키마 배럴.
 *
 * drizzle.config.ts 의 `schema` 가 이 디렉토리를 가리키고,
 * db/client.ts 는 여기서 모은 것을 `drizzle(client, { schema })` 로 넘긴다.
 * 새 테이블 파일을 추가하면 여기에도 re-export 한다.
 */

export * from "./auth";
export * from "./catalog";
export * from "./common";
export * from "./coverage";
export * from "./document";
export * from "./product";
export * from "./values";
