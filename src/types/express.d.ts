declare module 'express' {
  export type Request = {
    body: any;
    params: Record<string, string>;
    query: Record<string, unknown>;
    method?: string;
    on(event: string, callback: () => void): Request;
  };

  export type Response = {
    status(code: number): Response;
    json(payload: any): Response;
    header(name: string, value: string): Response;
    send(payload: any): Response;
    sendStatus(code: number): Response;
    write(payload: string): boolean;
    end(): void;
  };

  export type Handler = (req: Request, res: Response, next?: () => void) => unknown;

  export type Router = {
    get(path: string, handler: Handler): Router;
    post(path: string, handler: Handler): Router;
    use(handler: any): Router;
  };

  export function Router(): Router;

  type ExpressApp = {
    use(handler: any): void;
    use(path: string, handler: Handler): void;
    listen(port: number, callback?: () => void): void;
  };

  type ExpressFactory = {
    (): ExpressApp;
    json(): any;
  };

  const express: ExpressFactory;
  export default express;
}

declare module 'express-rate-limit' {
  type RateLimitOptions = {
    windowMs: number;
    max: number;
  };

  export default function rateLimit(options: RateLimitOptions): any;
}
