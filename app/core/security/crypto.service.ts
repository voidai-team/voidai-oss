import { injectable, inject } from 'inversify';
import crypto from 'crypto';
import { promisify } from 'util';
import type { ILogger } from '../logging';
import { TYPES } from '../container';

const scryptAsync = promisify(crypto.scrypt);

export interface HashOptions {
  algorithm?: 'sha256' | 'sha512' | 'blake2b512';
  iterations?: number;
  keyLength?: number;
  saltLength?: number;
}

export interface EncryptionResult {
  encrypted: string;
  salt: string;
  algorithm: string;
  iterations: number;
}

export interface SymmetricEncryptionResult {
  encrypted: string;
  iv: string;
  algorithm: string;
}

export interface ICryptoService {
  hashApiKey(apiKey: string, options?: HashOptions): Promise<EncryptionResult>;
  verifyApiKey(apiKey: string, hash: EncryptionResult): Promise<boolean>;
  encryptApiKey(apiKey: string, masterKey: string): SymmetricEncryptionResult;
  decryptApiKey(encryptedData: SymmetricEncryptionResult, masterKey: string): string;
  generateSecureToken(length?: number): string;
  createHmacSignature(data: string, secret: string): string;
  verifyHmacSignature(data: string, signature: string, secret: string): boolean;
  hashPassword(password: string): Promise<EncryptionResult>;
}

@injectable()
export class CryptoService implements ICryptoService {
  private readonly logger: ILogger;
  private readonly defaultOptions: Required<HashOptions> = {
    algorithm: 'sha512',
    iterations: 100000,
    keyLength: 64,
    saltLength: 32
  };

  constructor(@inject(TYPES.Logger) logger: ILogger) {
    this.logger = logger.createChild('CryptoService');
  }

  async hashApiKey(apiKey: string, options?: HashOptions): Promise<EncryptionResult> {
    const opts = { ...this.defaultOptions, ...options };
    
    try {
      const salt = crypto.randomBytes(opts.saltLength);
      const derivedKey = await scryptAsync(apiKey, salt, opts.keyLength) as Buffer;
      
      const result: EncryptionResult = {
        encrypted: derivedKey.toString('hex'),
        salt: salt.toString('hex'),
        algorithm: opts.algorithm,
        iterations: opts.iterations
      };

      this.logger.debug('API key hashed successfully', {
        metadata: {
          algorithm: opts.algorithm,
          keyLength: opts.keyLength,
          saltLength: opts.saltLength
        }
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to hash API key', error as Error);
      throw new Error('API key hashing failed');
    }
  }

  async verifyApiKey(apiKey: string, hash: EncryptionResult): Promise<boolean> {
    try {
      const salt = Buffer.from(hash.salt, 'hex');
      const derivedKey = await scryptAsync(apiKey, salt, hash.encrypted.length / 2) as Buffer;
      const hashBuffer = Buffer.from(hash.encrypted, 'hex');
      
      const isValid = crypto.timingSafeEqual(derivedKey, hashBuffer);
      
      this.logger.debug('API key verification completed', {
        metadata: {
          isValid,
          algorithm: hash.algorithm
        }
      });

      return isValid;
    } catch (error) {
      this.logger.error('API key verification failed', error as Error);
      return false;
    }
  }

  generateSecureToken(length: number = 32): string {
    try {
      const token = crypto.randomBytes(length).toString('hex');
      
      this.logger.debug('Secure token generated', {
        metadata: { tokenLength: token.length }
      });

      return token;
    } catch (error) {
      this.logger.error('Failed to generate secure token', error as Error);
      throw new Error('Token generation failed');
    }
  }

  createHmacSignature(data: string, secret: string): string {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(data);
      const signature = hmac.digest('hex');
      
      this.logger.debug('HMAC signature created');
      
      return signature;
    } catch (error) {
      this.logger.error('Failed to create HMAC signature', error as Error);
      throw new Error('HMAC signature creation failed');
    }
  }

  verifyHmacSignature(data: string, signature: string, secret: string): boolean {
    try {
      const expectedSignature = this.createHmacSignature(data, secret);
      const signatureBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      
      if (signatureBuffer.length !== expectedBuffer.length) {
        return false;
      }
      
      const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
      
      this.logger.debug('HMAC signature verification completed', {
        metadata: { isValid }
      });

      return isValid;
    } catch (error) {
      this.logger.error('HMAC signature verification failed', error as Error);
      return false;
    }
  }

  async hashPassword(password: string): Promise<EncryptionResult> {
    return this.hashApiKey(password, {
      iterations: 150000,
      keyLength: 64,
      saltLength: 32
    });
  }

  encryptApiKey(apiKey: string, masterKey: string): SymmetricEncryptionResult {
    try {
      const iv = crypto.randomBytes(16);
      const key = Buffer.from(masterKey.padEnd(32, '0').slice(0, 32), 'utf8');
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      
      let encrypted = cipher.update(apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const result: SymmetricEncryptionResult = {
        encrypted,
        iv: iv.toString('hex'),
        algorithm: 'aes-256-cbc'
      };

      this.logger.debug('API key encrypted successfully', {
        metadata: {
          algorithm: result.algorithm,
          ivLength: result.iv.length
        }
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to encrypt API key', error as Error);
      throw new Error('API key encryption failed');
    }
  }

  decryptApiKey(encryptedData: SymmetricEncryptionResult, masterKey: string): string {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const key = Buffer.from(masterKey.padEnd(32, '0').slice(0, 32), 'utf8');
      const decipher = crypto.createDecipheriv(encryptedData.algorithm, key, iv);
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      this.logger.debug('API key decrypted successfully', {
        metadata: {
          algorithm: encryptedData.algorithm
        }
      });

      return decrypted;
    } catch (error) {
      this.logger.error('Failed to decrypt API key', error as Error);
      throw new Error('API key decryption failed');
    }
  }
}