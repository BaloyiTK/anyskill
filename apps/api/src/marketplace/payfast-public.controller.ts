import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { PayFastService } from "./payfast.service";

type PayFastRequest = { ip?: string; socket?: { remoteAddress?: string } };
type HtmlResponse = { type(contentType: string): HtmlResponse; send(body: string): void };

@Controller("marketplace/payments/payfast")
export class PayFastPublicController {
  constructor(private readonly payfast: PayFastService) {}

  @Get("checkout/:merchantPaymentId")
  async checkoutPage(@Param("merchantPaymentId") merchantPaymentId: string, @Res() response: HtmlResponse) {
    const html = await this.payfast.getCheckoutHtml(merchantPaymentId);
    response.type("text/html").send(html);
  }

  @Post("itn")
  @HttpCode(200)
  async receiveItn(@Body() body: Record<string, string>, @Req() request: PayFastRequest) {
    const sourceIp = request.ip ?? request.socket?.remoteAddress ?? "";
    await this.payfast.handleItn(body, sourceIp);
    return "OK";
  }
}
