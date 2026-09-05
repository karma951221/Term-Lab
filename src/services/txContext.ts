/**
 * 트랜잭션 문맥 Db — 주입 소스가 「지금 열려 있는 트랜잭션」을 자동으로 타게 하는 프록시.
 *
 * 문제: PGlite 는 단일 연결이라 트랜잭션이 열린 동안 바깥 핸들(`db`)로 쿼리하면 교착한다.
 * 그런데 서비스들은 주입 소스(ImpactSource · UsageSource · CoverageMasterSource …)를 트랜잭션 **안**에서
 * 부르면서 tx 를 넘겨주지 않는다 (인터페이스가 tx 를 모른다). 각 서비스를 고치지 않고 조립 루트에서
 * 풀기 위해, `AsyncLocalStorage` 로 현재 tx 를 기억하는 Db 프록시를 모든 서비스·소스에 넘긴다.
 *
 * - `proxy.transaction(fn)` : 현재 핸들(바깥이면 db, 이미 tx 안이면 그 tx → 세이브포인트)로 트랜잭션을 열고,
 *   콜백이 도는 동안 그 tx 를 문맥에 둔다.
 * - 그 밖의 모든 접근(`select` · `insert` · `query` …) : 문맥에 tx 가 있으면 tx, 없으면 db 로 간다.
 *
 * 결과: 서비스가 `db.transaction(async (tx) => … await source.find(…))` 를 호출하면, 소스가 프록시로 낸 쿼리가
 * 같은 tx 위에서 돈다. 서비스 코드는 repo 에 tx 를 명시적으로 넘기는 기존 방식 그대로다.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { Db } from "@/db/repo/types";

const context = new AsyncLocalStorage<Db>();

/** 현재 문맥의 핸들 — 열린 tx 가 있으면 그것, 없으면 root. (소스가 직접 쓸 일은 드물다 — 프록시가 대신한다.) */
export function currentDb(root: Db): Db {
  return context.getStore() ?? root;
}

/** 문맥 인식 Db 프록시. 타입은 Db 그대로라 서비스·repo 에 그대로 넘긴다. */
export function contextualDb(root: Db): Db {
  const current = () => context.getStore() ?? root;
  const transaction: Db["transaction"] = (fn, config) => current().transaction((tx) => context.run(tx, () => fn(tx)), config);
  return new Proxy(root, {
    get(_target, prop) {
      if (prop === "transaction") return transaction;
      const handle = current() as unknown as Record<string | symbol, unknown>;
      const value = handle[prop];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(handle) : value;
    },
  });
}
