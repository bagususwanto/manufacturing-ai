import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { WarehouseService } from 'src/modules/warehouse/warehouse.service';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from 'src/shared/open-webui/interfaces/open-webui.interface';
import { answerResponse } from '../interfaces/response.interface';

@Injectable()
export class OpenWebuiService {
  constructor(private readonly warehouseService: WarehouseService) {}

  private models = ['warehouse'];
  private modelMapping = {
    warehouse: 'gemma3:1b',
  };

  private capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  getModels() {
    return {
      object: 'list',
      data: this.models.map((model) => ({
        id: model,
        name: this.capitalizeFirstLetter(model),
        description: `Model for ${model} queries`,
        object: 'model',
        created: Date.now(),
        owned_by: 'manufactureAI',
      })),
    };
  }

  getInternalModel(apiModel: string): string {
    return this.modelMapping[apiModel] || 'gemma3:1b';
  }

  getModelInfo(model: string) {
    return {
      id: model || 'gemma3:1b',
      object: 'model',
      created: Date.now(),
      owned_by: 'manufactureAI',
      permission: [],
      root: model || 'gemma3:1b',
      parent: null,
    };
  }

  // Main chat completions method with comprehensive error handling
  async chatCompletions(
    body: ChatCompletionRequest,
    res: Response,
    auth?: string,
  ) {
    try {
      const {
        messages,
        model = 'warehouse',
        stream = false,
        temperature,
        max_tokens,
      } = body;

      // Extract content properly handling both string and object types
      const lastUserMessage = this.extractMessageContent(messages);

      // Validate model
      if (!this.models.includes(model)) {
        return res.status(400).json({
          error: {
            message: `Model '${model}' not found. Available models: ${this.models.join(', ')}`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        });
      }

      // Convert API model to internal model
      const internalModel = this.getInternalModel(model);

      if (stream) {
        // Handle streaming response with proper SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization',
        );

        return this.handleStreamingResponse(
          lastUserMessage,
          model,
          internalModel,
          res,
        );
      } else {
        // Handle non-streaming response
        return this.handleNonStreamingResponse(
          lastUserMessage,
          model,
          internalModel,
          res,
        );
      }
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

  // Helper method to safely extract message content
  private extractMessageContent(messages: any[]): string {
    if (!messages || !Array.isArray(messages)) {
      return '';
    }

    // Get the last user message from the conversation
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find((m) => m.role === 'user');

    if (!lastUserMessage) {
      return '';
    }

    // Handle different content formats
    if (typeof lastUserMessage.content === 'string') {
      return lastUserMessage.content;
    } else if (
      typeof lastUserMessage.content === 'object' &&
      lastUserMessage.content !== null
    ) {
      // Handle object content (e.g., multimodal messages)
      if (Array.isArray(lastUserMessage.content)) {
        // Handle array of content objects
        const textContent = lastUserMessage.content.find(
          (item) => item.type === 'text',
        );
        return textContent?.text || '';
      } else if (lastUserMessage.content.text) {
        return lastUserMessage.content.text;
      } else if (lastUserMessage.content.content) {
        return lastUserMessage.content.content;
      }
    }

    return '';
  }

  // Simple token estimation (approximate)
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough estimation: 1 token ≈ 4 characters for most languages
    return Math.ceil(text.length / 4);
  }

  // Handle non-streaming responses
  private async handleNonStreamingResponse(
    lastUserMessage: string,
    model: string,
    internalModel: string,
    res: Response,
  ) {
    try {
      const answer: answerResponse = await this.validateModelService(
        model,
        lastUserMessage,
        internalModel,
      );

      const responseContent =
        answer.message?.content || 'Maaf, tidak ada jawaban yang tersedia.';

      const response: ChatCompletionResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: responseContent,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: this.estimateTokens(lastUserMessage),
          completion_tokens: this.estimateTokens(responseContent),
          total_tokens:
            this.estimateTokens(lastUserMessage) +
            this.estimateTokens(responseContent),
        },
      };

      return res.json(response);
    } catch (error) {
      console.error('Non-streaming response error:', error);
      return res.status(500).json({
        error: {
          message: 'Error processing non-streaming response',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  }

  // Validate and route to appropriate model service
  private async validateModelService(
    model: string,
    question: string,
    internalModel: string,
  ): Promise<answerResponse> {
    if (model === 'warehouse') {
      // Use the warehouse service for the 'warehouse' model
      return await this.warehouseService.handleQuery(question);
    } else {
      // For other models, you can implement additional logic here
      return {
        message: {
          role: 'assistant',
          content: `Model '${model}' is not supported.`,
        },
        done: true,
      };
    }
  }

  // Handle streaming responses with proper SSE format
  private async handleStreamingResponse(
    question: string,
    model: string,
    internalModel: string,
    res: Response,
  ) {
    try {
      const answer: answerResponse = await this.validateModelService(
        model,
        question,
        internalModel,
      );

      console.log(
        'Answer received in handleStreamingResponse:',
        typeof answer,
        answer,
      );

      // Safely extract content with fallback
      let content = 'Maaf, tidak ada jawaban yang tersedia.';

      if (answer && typeof answer === 'object' && answer.message?.content) {
        content = answer.message.content;
      } else if (typeof answer === 'string') {
        // Handle case where answer is unexpectedly a string
        try {
          const parsed = JSON.parse(answer);
          content = parsed.message?.content || answer;
        } catch {
          content = answer;
        }
      }

      // Split content into smaller chunks for better streaming experience
      const words = content.split(' ');
      const chunks: string[] = [];

      // Group words into chunks of 2-3 words each
      for (let i = 0; i < words.length; i += 2) {
        chunks.push(words.slice(i, i + 2).join(' '));
      }

      // Send chunks with proper SSE format
      for (let i = 0; i < chunks.length; i++) {
        const chunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [
            {
              index: 0,
              delta: {
                content: i === 0 ? chunks[i] : ` ${chunks[i]}`,
              },
              finish_reason: null,
            },
          ],
        };

        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // Small delay for realistic streaming effect
        await new Promise((resolve) => setTimeout(resolve, 30));
      }

      // Send final chunk to indicate completion
      const finalChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: this.estimateTokens(question),
          completion_tokens: this.estimateTokens(content),
          total_tokens:
            this.estimateTokens(question) + this.estimateTokens(content),
        },
      };

      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error('Streaming error:', error);

      // Send error in SSE format
      const errorChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            delta: {
              content: 'Maaf, terjadi kesalahan saat memproses permintaan.',
            },
            finish_reason: 'stop',
          },
        ],
      };

      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}
