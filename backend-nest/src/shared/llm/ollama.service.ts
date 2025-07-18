import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class OllamaService implements OnModuleInit {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  private readonly model = 'gemma3:1b'; // Ganti dengan model yang sesuai
  private isServerAvailable = false;

  async onModuleInit() {
    await this.checkServerVersion();
  }

  private async checkServerVersion() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/version`);
      this.isServerAvailable = true;
      this.logger.log(
        `Connected to Ollama server version: ${response.data.version}`,
      );
    } catch (error) {
      this.isServerAvailable = false;
      this.logger.error(
        'Failed to connect to Ollama server. Please ensure it is running.',
      );
      this.logger.error('You can start it by running: ollama serve');
    }
  }

  async ask(prompt: string, model: string): Promise<string> {
    if (!this.isServerAvailable) {
      return 'Maaf, server Ollama tidak tersedia. Silakan pastikan server Ollama berjalan.';
    }

    try {
      const res = await axios.post(`${this.baseUrl}/api/generate`, {
        model: model,
        prompt,
        stream: false,
      });

      return res.data.response.trim();
    } catch (err) {
      this.logger.error('Failed to get response from Ollama', err);
      return 'Maaf, saya tidak dapat menjawab sekarang.';
    }
  }
}
