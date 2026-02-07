import { useState, useEffect } from 'react';
import { App } from '@modelcontextprotocol/ext-apps';

export function useToolData<T>(): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const app = new App();

    app.ontoolresult = (result: any) => {
      // The host pushes tool result content; parse the first text item as JSON
      if (result?.content) {
        const textItem = Array.isArray(result.content)
          ? result.content.find((c: any) => c.type === 'text')
          : null;
        if (textItem?.text) {
          try {
            setData(JSON.parse(textItem.text) as T);
          } catch {
            // Not JSON — use raw text as-is
            setData(textItem.text as unknown as T);
          }
        }
      }
    };

    app.connect();

    return () => {
      app.close();
    };
  }, []);

  return data;
}
