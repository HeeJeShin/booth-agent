// 개발용 샘플 데이터. `pnpm db:seed`로 넣습니다.
// 여러 번 실행해도 결과가 같도록(멱등) 먼저 비우고 다시 넣습니다.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  await prisma.application.deleteMany();
  await prisma.exhibition.deleteMany();

  await prisma.exhibition.createMany({
    data: [
      {
        name: "2026 그린에너지 엑스포",
        venue: "코엑스 A홀",
        startDate: new Date("2026-11-18"),
        endDate: new Date("2026-11-20"),
        applyDeadline: new Date("2026-10-31"),
        boothPrice: 2_500_000,
        totalBooths: 120,
      },
      {
        name: "2026 스마트관광 박람회",
        venue: "킨텍스 제2전시장",
        startDate: new Date("2026-12-03"),
        endDate: new Date("2026-12-05"),
        applyDeadline: new Date("2026-11-15"),
        boothPrice: 1_800_000,
        totalBooths: 80,
      },
      {
        name: "2026 키즈 에듀 페어 (마감)",
        venue: "세텍 1전시실",
        startDate: new Date("2026-10-20"),
        endDate: new Date("2026-10-22"),
        applyDeadline: new Date("2026-09-30"),
        boothPrice: 1_200_000,
        totalBooths: 40,
      },
    ],
  });
  console.log("seed 완료");
}

main().finally(() => prisma.$disconnect());
