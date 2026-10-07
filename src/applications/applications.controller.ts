import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApplicationsService } from "./applications.service";
import { CreateApplicationDto } from "./dto/create-application.dto";

@ApiTags("applications")
@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  // @Body()의 타입을 DTO 클래스로 적으면, 전역 ValidationPipe가 이 클래스 규칙으로 body를 검사합니다.
  // ⚠️ 타입을 interface로 쓰면 검사가 안 됩니다. 런타임에 남는 건 class뿐이라서요.
  @Post() // POST /applications → 201 Created
  create(@Body() dto: CreateApplicationDto) {
    return this.applications.create(dto);
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.applications.findOne(id);
  }

  // REST 관례: 취소는 "상태를 바꾸는 것"이라 DELETE보다 PATCH가 의미에 맞습니다.
  @Patch(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id", ParseIntPipe) id: number) {
    return this.applications.cancel(id);
  }
}
