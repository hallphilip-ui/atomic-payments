declare module 'express' {
  export type Request = {
    body: any;
    params: Record<string, string>;
    query: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    method?: string;
    originalUrl?: string;
    ip?: string;
    on(event: string, callback: () => void): Request;
  };

  export type Response = {
    locals: Record<string, any>;
    statusCode: number;
    status(code: number): Response;
    json(payload: any): Response;
    header(name: string, value: string): Response;
    setHeader(name: string, value: string): Response;
    send(payload: any): Response;
    sendStatus(code: number): Response;
    write(payload: string): boolean;
    on(event: string, callback: () => void): Response;
    end(): void;
  };

  export type NextFunction = () => void;
  export type Handler = (req: Request, res: Response, next?: NextFunction) => unknown;

  export type Router = {
    get(path: string, handler: Handler): Router;
    post(path: string, handler: Handler): Router;
    use(handler: any): Router;
  };

  export function Router(): Router;

  type ExpressApp = {
    use(handler: any): void;
    use(path: string, handler: Handler): void;
    get(path: string, handler: Handler): void;
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
