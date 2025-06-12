import axios from 'axios';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedText(
  text: string,
  retries = 3,
  baseDelay = 1000,
): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await axios.post('http://localhost:11434/api/embeddings', {
        model: 'nomic-embed-text',
        prompt: text,
      });
      return res.data.embedding;
    } catch (error) {
      if (
        error.response?.status === 503 &&
        error.response?.data?.error?.includes('server busy')
      ) {
        if (attempt === retries - 1) {
          throw new Error(
            'Failed to get embeddings after multiple retries: Ollama server is busy',
          );
        }
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Ollama server busy, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to get embeddings after multiple retries');
}

export default embedText;
