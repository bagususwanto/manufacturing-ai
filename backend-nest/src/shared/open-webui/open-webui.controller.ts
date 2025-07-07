import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  Headers,
  Param,
} from '@nestjs/common';
import { Response } from 'express';
import { ChatCompletionRequest } from 'src/shared/open-webui/interfaces/open-webui.interface';
import { OpenWebuiService } from './open-webui.service';

@Controller('open-webui')
export class OpenWebuiController {
  constructor(private readonly openWebuiService: OpenWebuiService) {}

  @Get('v1/models')
  getModels() {
    return this.openWebuiService.getModels();
  }

  @Post('v1/chat/completions')
  async chatCompletions(
    @Body() body: ChatCompletionRequest,
    @Res() res: Response,
    @Headers('authorization') auth?: string,
  ) {
    try {
      // Pass auth parameter to service method
      return await this.openWebuiService.chatCompletions(body, res, auth);
    } catch (error) {
      console.error('Error in chat completions:', error);
      return res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  // Fixed: Use @Param instead of @Body for URL parameter
  @Get('v1/models/:model')
  getModelInfo(@Param('model') model: string) {
    return this.openWebuiService.getModelInfo(model);
  }
}
