import { defineConfig } from "vitest/config";

// Vitest는 esbuild로 TS를 변환합니다. esbuild는 데코레이터 메타데이터를 만들지 않아서
// Nest의 자동 DI(Test.createTestingModule)는 그대로 못 씁니다.
// 그래서 단위 테스트에선 서비스를 new로 직접 만들고, 의존성은 가짜 객체를 손으로 넣습니다.
export default defineConfig({
  test: { include: ["src/**/*.spec.ts"], environment: "node" },
});
