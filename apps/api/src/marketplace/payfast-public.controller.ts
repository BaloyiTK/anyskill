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

  @Get("return")
  async checkoutReturn(@Res() response: HtmlResponse) {
    response.type("text/html").send("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Return to AnySkill</title></head><body><main><h1>Return to AnySkill</h1><p>PayFast has returned you to AnySkill. Payment is recorded only after the secure server notification is verified.</p><p>Switch back to the AnySkill app and refresh the payment status.</p></main></body></html>");
  }

  @Get("cancel")
  async checkoutCancel(@Res() response: HtmlResponse) {
    response.type("text/html").send("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Checkout cancelled</title></head><body><main><h1>Checkout cancelled</h1><p>Return to AnySkill. No payment is marked as successful unless PayFast sends a verified confirmation.</p></main></body></html>");
  }

  @Post("itn")
  @HttpCode(200)
  async receiveItn(@Body() body: Record<string, string>, @Req() request: PayFastRequest) {
    const sourceIp = request.ip ?? request.socket?.remoteAddress ?? "";
    await this.payfast.handleItn(body, sourceIp);
    return "OK";
  }
}
