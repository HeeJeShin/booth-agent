// Prisma 7부터는 DB 접속 정보를 schema.prisma가 아니라 이 설정 파일에 둡니다.
// 그리고 .env를 자동으로 읽어주지 않으므로 dotenv를 직접 불러옵니다.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
