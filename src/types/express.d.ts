declare module 'express' {
  export type Request = {
    body: any;
    params: Record<string, string>;
    query: Record<string, unknown>;
  };

  export type Response = {
    status(code: number): Response;
    json(payload: any): Response;
  };

  export type Handler = (req: Request, res: Response) => unknown;

  export type Router = {
    get(path: string, handler: Handler): Router;
    post(path: string, handler: Handler): Router;
    use(handler: any): Router;
  };

  export function Router(): Router;

  type ExpressApp = {
    use(handler: any): void;
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
