import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { renderInvoicePdf } from './invoice-pdf.util';
import { InvoicesService } from './invoices.service';

// Every route scoped to the calling business's own invoices — same
// ownership pattern as business-customers/staff/api-keys.
@ApiTags('Business — Invoices')
@ApiBearerAuth('access-token')
@Controller('business/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly businessProfileService: BusinessProfileService,
  ) {}

  @Post()
  generate(@Body() dto: GenerateInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.generate(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.invoicesService.list(user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.invoicesService.findOne(user.sub, id);
  }

  // GET /business/invoices/:id/pdf — streams the invoice as a real PDF
  // download rather than returning JSON. @Res() takes over the
  // response entirely (no automatic Nest serialization), so this is
  // the one route in the module that doesn't just `return` its result.
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const invoice = await this.invoicesService.findOne(user.sub, id);
    const profile = await this.businessProfileService.getOrCreateProfile(user.sub);
    const pdfBuffer = await renderInvoicePdf(invoice, profile.businessName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  }
}
