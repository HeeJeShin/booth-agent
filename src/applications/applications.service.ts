import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateApplicationDto } from "./dto/create-application.dto";

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApplicationDto) {
    // ⭐ 트랜잭션: 안의 쿼리들이 "전부 성공하거나 전부 취소"됩니다.
    //
    // 왜 필요한가? (동시성 문제, Race Condition)
    //   남은 부스가 1개일 때 A사와 B사가 "동시에" 1개씩 신청하면,
    //   두 요청 모두 "남은 수량 1 → 신청 가능"이라고 읽고 둘 다 저장해버립니다(초과 판매).
    //   프론트에서 버튼을 막는 것만으로는 절대 해결이 안 됩니다. 서버·DB에서 막아야 합니다.
    //   (스마트관광 결제 정합성 문제를 백엔드로 옮기자고 했던 이유와 같은 원리)
    return this.prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE: 이 전시회 행에 "잠금"을 겁니다.
      // 같은 전시회에 대한 다른 트랜잭션은 여기서 기다렸다가, 앞 트랜잭션이 끝난 뒤에 최신 값을 읽습니다.
      // 템플릿 리터럴($queryRaw`...${값}`)은 값을 자동으로 바인딩해서 SQL 인젝션을 막아줍니다.
      // ⚠️ 문자열을 직접 이어붙이는 $queryRawUnsafe는 쓰지 마세요.
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "Exhibition" WHERE id = ${dto.exhibitionId} FOR UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException(`전시회 ${dto.exhibitionId}번을 찾을 수 없습니다.`);
      }

      const exhibition = await tx.exhibition.findUniqueOrThrow({ where: { id: dto.exhibitionId } });
      if (exhibition.applyDeadline < new Date()) {
        throw new BadRequestException("신청 마감일이 지났습니다.");
      }

      const agg = await tx.application.aggregate({
        where: { exhibitionId: dto.exhibitionId, status: { not: "CANCELLED" } },
        _sum: { boothCount: true },
      });
      const remaining = exhibition.totalBooths - (agg._sum.boothCount ?? 0);
      if (dto.boothCount > remaining) {
        // 409 Conflict: 요청 형식은 맞지만 "현재 상태"와 충돌해서 처리할 수 없음.
        throw new ConflictException(`남은 부스가 ${remaining}개라 ${dto.boothCount}개를 신청할 수 없습니다.`);
      }

      return tx.application.create({
        data: {
          ...dto,
          // 가격은 항상 서버가 DB 값으로 계산합니다. 클라이언트가 보낸 금액은 믿지 않습니다.
          totalPrice: exhibition.boothPrice * dto.boothCount,
        },
        include: { exhibition: { select: { name: true } } },
      });
    });
  }

  async findOne(id: number) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { exhibition: { select: { name: true, venue: true } } },
    });
    if (!application) throw new NotFoundException(`신청 ${id}번을 찾을 수 없습니다.`);
    return application;
  }

  async cancel(id: number) {
    const application = await this.findOne(id);
    if (application.status === "CANCELLED") {
      throw new ConflictException("이미 취소된 신청입니다.");
    }
    // 삭제(DELETE) 대신 상태 변경(소프트 삭제): 누가 언제 취소했는지 이력이 남습니다.
    return this.prisma.application.update({ where: { id }, data: { status: "CANCELLED" } });
  }
}
