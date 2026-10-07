import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExhibitionsService } from "./exhibitions.service";

// 컨트롤러는 "어떤 URL이 어떤 서비스 메서드를 부르는지"만 정합니다. 로직은 서비스에.
// 그래야 같은 로직을 AI 에이전트 도구에서도 그대로 재사용할 수 있습니다(이 프로젝트의 핵심).
@ApiTags("exhibitions")
@Controller("exhibitions") // → /exhibitions
export class ExhibitionsController {
  constructor(private readonly exhibitions: ExhibitionsService) {}

  @Get() // GET /exhibitions
  findAll() {
    return this.exhibitions.findAll();
  }

  // ParseIntPipe: URL의 ":id"는 항상 문자열이라 숫자로 바꾸고, 숫자가 아니면 400을 돌려줍니다.
  @Get(":id") // GET /exhibitions/1
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.exhibitions.findOne(id);
  }
}
