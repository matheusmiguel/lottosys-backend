import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { LinksService } from './links/links.service';
import { EventsService } from './events/events.service';

@Controller()
export class AppController {
	constructor(
		private readonly appService: AppService,
		private readonly linksService: LinksService,
		private readonly eventsService: EventsService
	) { }

	@Get()
	getHello(): string {
		return this.appService.getHello();
	}

	@Post('external/events')
	async enqueueEvent(@Body() body: any) {
		await this.eventsService.enqueueEvent(body);

		return {
			status: 'success',
			message: 'Event received successfully',
		};
	}

	@Get('l/:link_id/:user_id')
	async linkUrl(
		@Param('link_id') link_id: number,
		@Param('user_id') user_id: number,
		@Req() req,
		@Res() res,
	): Promise<any> {
		const result = await this.linksService.handleLink(req, link_id, user_id);
		return res.redirect(result.redirect);
	}
}
