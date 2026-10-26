// Process environment for React components
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
  }
}

// Global process for browser environments
declare const process: {
  env: {
    NODE_ENV: string;
  };
};
