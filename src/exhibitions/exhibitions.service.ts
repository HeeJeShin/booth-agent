import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ExhibitionsService {
  // constructor에 타입만 적으면 Nest가 PrismaService 인스턴스를 넣어줍니다(DI).
  // `private readonly`를 붙이면 this.prisma로 바로 쓸 수 있는 필드가 됩니다.
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const exhibitions = await this.prisma.exhibition.findMany({ orderBy: { startDate: "asc" } });
    // N+1 문제 주의: 전시회마다 따로 "예약된 부스 수"를 조회하면 쿼리가 N번 더 나갑니다.
    // groupBy로 한 번에 집계해 오면 전시회가 100개여도 쿼리는 2번입니다.
    const reserved = await this.prisma.application.groupBy({
      by: ["exhibitionId"],
      where: { status: { not: "CANCELLED" } },
      _sum: { boothCount: true },
    });
    const reservedMap = new Map(reserved.map((r) => [r.exhibitionId, r._sum.boothCount ?? 0]));

    return exhibitions.map((e) => ({
      ...e,
      remainingBooths: e.totalBooths - (reservedMap.get(e.id) ?? 0),
      isOpen: e.applyDeadline >= new Date(),
    }));
  }

  async findOne(id: number) {
    const exhibition = await this.prisma.exhibition.findUnique({ where: { id } });
    // 없는 리소스는 404. Nest의 HttpException 계열을 던지면 알맞은 상태코드 응답으로 바뀝니다.
    if (!exhibition) throw new NotFoundException(`전시회 ${id}번을 찾을 수 없습니다.`);

    const agg = await this.prisma.application.aggregate({
      where: { exhibitionId: id, status: { not: "CANCELLED" } },
      _sum: { boothCount: true },
    });
    return {
      ...exhibition,
      remainingBooths: exhibition.totalBooths - (agg._sum.boothCount ?? 0),
      isOpen: exhibition.applyDeadline >= new Date(),
    };
  }
}
