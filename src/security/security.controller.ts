import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Response } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { AuthGuard, RolesGuard, PermissionsGuard, MfaGuard, ApiKeyGuard, RateLimitGuard } from './guards/auth.guard';
import { Public, Roles, Permissions, AdminOnly, RequirePermission } from './decorators/security.decorators';
import { JwtService } from '@nestjs/jwt';

export class LoginDto {
  email!: string;
  password!: string;
  mfaToken?: string;
  backupCode?: string;
}

export class RegisterDto {
  email!: string;
  password!: string;
  firstName!: string;
  lastName!: string;
  tenantId?: string;
}

export class ChangePasswordDto {
  currentPassword!: string;
  newPassword!: string;
}

export class MfaSetupDto {
  secret!: string;
  token!: string;
}

export class MfaVerifyDto {
  token!: string;
}

@ApiTags('security')
@Controller('security')
@UseGuards(AuthGuard, RateLimitGuard)
export class SecurityController {
  constructor(
    private securityService: SecurityService,
    private jwtService: JwtService,
  ) {}

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'User login with optional MFA' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 423, description: 'Account locked' })
  async login(@Body() loginDto: LoginDto, @Request() req: any, @Response() res: any) {
    const { email, password, mfaToken, backupCode } = loginDto;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || '';

    try {
      // In a real implementation, you would validate credentials against a database
      // For now, we'll simulate a user
      const user = {
        id: 'user-123',
        email,
        password: await this.securityService.hashPassword(password),
        mfaEnabled: true,
        mfaSecret: 'JBSWY3DPEHPK3PXP',
        backupCodes: ['ABCD1234', 'EFGH5678'],
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        passwordChangedAt: new Date(),
        passwordHistory: [],
        roles: ['user'],
        permissions: ['read:profile', 'update:profile'],
        tenantId: 'tenant-123',
      };

      // Check brute force protection
      const bruteForceCheck = this.securityService.checkBruteForceProtection(user.id, ipAddress);
      if (!bruteForceCheck.allowed) {
        this.securityService.recordFailedLoginAttempt(user.id, email, ipAddress, userAgent, 'Account locked due to brute force protection');
        return res.status(423).json({
          success: false,
          message: 'Account temporarily locked due to too many failed attempts',
          lockoutDuration: bruteForceCheck.lockoutDuration,
        });
      }

      // Verify password
      const passwordValid = await this.securityService.verifyPassword(password, user.password);
      if (!passwordValid) {
        this.securityService.recordFailedLoginAttempt(user.id, email, ipAddress, userAgent, 'Invalid password');
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
        });
      }

      // Check MFA if enabled
      if (user.mfaEnabled) {
        if (!mfaToken && !backupCode) {
          return res.status(200).json({
            success: true,
            message: 'MFA required',
            mfaRequired: true,
            tempToken: this.securityService.generateToken({ userId: user.id, mfaPending: true }),
          });
        }

        if (mfaToken) {
          const mfaValid = this.securityService.verifyMFAToken(mfaToken, user.mfaSecret);
          if (!mfaValid) {
            this.securityService.recordFailedLoginAttempt(user.id, email, ipAddress, userAgent, 'Invalid MFA token');
            return res.status(401).json({
              success: false,
              message: 'Invalid MFA token',
            });
          }
        } else if (backupCode) {
          const backupValid = this.securityService.verifyBackupCode(backupCode, user.backupCodes);
          if (!backupValid) {
            this.securityService.recordFailedLoginAttempt(user.id, email, ipAddress, userAgent, 'Invalid backup code');
            return res.status(401).json({
              success: false,
              message: 'Invalid backup code',
            });
          }
        }
      }

      // Generate tokens
      const token = this.securityService.generateToken({
        userId: user.id,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
        tenantId: user.tenantId,
        mfaVerified: true,
      });

      const refreshToken = this.securityService.generateRefreshToken({
        userId: user.id,
        email: user.email,
      });

      // Record successful login
      this.securityService.recordSuccessfulLoginAttempt(user.id, email, ipAddress, userAgent);

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            roles: user.roles,
            permissions: user.permissions,
            tenantId: user.tenantId,
            mfaEnabled: user.mfaEnabled,
          },
        },
      });

    } catch (error) {
      this.securityService.recordFailedLoginAttempt('unknown', email, ipAddress, userAgent, error instanceof Error ? error.message : String(error));
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'User registration' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async register(@Body() registerDto: RegisterDto) {
    const { email, password, firstName, lastName, tenantId } = registerDto;

    // Validate password strength
    const passwordValidation = this.securityService.validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return {
        success: false,
        message: 'Password does not meet requirements',
        errors: passwordValidation.errors,
      };
    }

    // Hash password
    const hashedPassword = await this.securityService.hashPassword(password);

    // In a real implementation, you would save the user to the database
    const user = {
      id: 'user-' + Math.random().toString(36).substring(2, 15),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      tenantId,
      mfaEnabled: false,
      roles: ['user'],
      permissions: ['read:profile', 'update:profile'],
      createdAt: new Date(),
    };

    return {
      success: true,
      message: 'Registration successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          tenantId: user.tenantId,
        },
      },
    };
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ schema: { properties: { refreshToken: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken(@Body() body: { refreshToken: string }) {
    try {
      const payload = this.securityService.verifyRefreshToken(body.refreshToken);
      
      // Generate new access token
      const token = this.securityService.generateToken({
        userId: payload.userId,
        email: payload.email,
        roles: ['user'], // This would come from the database
        permissions: ['read:profile', 'update:profile'],
      });

      return {
        success: true,
        message: 'Token refreshed successfully',
        data: { token },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Invalid refresh token',
      };
    }
  }

  @Post('change-password')
  @ApiOperation({ summary: 'Change user password' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid current password' })
  async changePassword(@Body() changePasswordDto: ChangePasswordDto, @Request() req: any) {
    const { currentPassword, newPassword } = changePasswordDto;
    const userId = req.user.userId;

    // Validate new password strength
    const passwordValidation = this.securityService.validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return {
        success: false,
        message: 'New password does not meet requirements',
        errors: passwordValidation.errors,
      };
    }

    // In a real implementation, you would:
    // 1. Get user from database
    // 2. Verify current password
    // 3. Check password history
    // 4. Update password

    const hashedPassword = await this.securityService.hashPassword(newPassword);

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }

  @Get('mfa/setup')
  @ApiOperation({ summary: 'Get MFA setup information' })
  @ApiResponse({ status: 200, description: 'MFA setup information retrieved' })
  async getMfaSetup(@Request() req: any) {
    const userId = req.user.userId;

    // Generate MFA secret
    const secret = this.securityService.generateMFASecret({ email: req.user.email } as any);
    const qrCode = await this.securityService.generateMFAQRCode(secret, { email: req.user.email } as any);

    return {
      success: true,
      data: {
        secret,
        qrCode,
        backupCodes: this.securityService.generateBackupCodes(),
      },
    };
  }

  @Post('mfa/verify')
  @ApiOperation({ summary: 'Verify MFA token' })
  @ApiBody({ type: MfaVerifyDto })
  @ApiResponse({ status: 200, description: 'MFA token verified' })
  @ApiResponse({ status: 400, description: 'Invalid MFA token' })
  async verifyMfa(@Body() mfaVerifyDto: MfaVerifyDto, @Request() req: any) {
    const { token } = mfaVerifyDto;
    const userId = req.user.userId;

    // In a real implementation, you would get the user's MFA secret from the database
    const mfaSecret = 'JBSWY3DPEHPK3PXP'; // This would come from the database

    const isValid = this.securityService.verifyMFAToken(token, mfaSecret);

    if (!isValid) {
      return {
        success: false,
        message: 'Invalid MFA token',
      };
    }

    return {
      success: true,
      message: 'MFA token verified successfully',
    };
  }

  @Get('security-events')
  @AdminOnly()
  @ApiOperation({ summary: 'Get security events (Admin only)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'severity', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Security events retrieved' })
  async getSecurityEvents(@Query('limit') limit: number = 100, @Query('severity') severity?: string) {
    const events = this.securityService.getSecurityEvents(limit, severity);

    return {
      success: true,
      data: {
        events,
        count: events.length,
      },
    };
  }

  @Get('login-attempts')
  @AdminOnly()
  @ApiOperation({ summary: 'Get login attempts for user (Admin only)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Login attempts retrieved' })
  async getLoginAttempts(@Param('userId') userId: string, @Query('limit') limit: number = 50) {
    const attempts = this.securityService.getLoginAttempts(userId, limit);

    return {
      success: true,
      data: {
        attempts,
        count: attempts.length,
      },
    };
  }

  @Get('security-stats')
  @AdminOnly()
  @ApiOperation({ summary: 'Get security statistics (Admin only)' })
  @ApiResponse({ status: 200, description: 'Security statistics retrieved' })
  async getSecurityStats() {
    const stats = this.securityService.getSecurityStats();

    return {
      success: true,
      data: stats,
    };
  }

  @Post('cleanup')
  @AdminOnly()
  @ApiOperation({ summary: 'Clean up old security data (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cleanup completed' })
  async cleanupOldData() {
    this.securityService.cleanupOldData();

    return {
      success: true,
      message: 'Old security data cleaned up successfully',
    };
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@Request() req: any) {
    const userId = req.user.userId;

    // In a real implementation, you would get user data from the database
    const user = {
      id: userId,
      email: req.user.email,
      roles: req.user.roles,
      permissions: req.user.permissions,
      tenantId: req.user.tenantId,
      lastLoginAt: new Date(),
    };

    return {
      success: true,
      data: { user },
    };
  }

  @Post('logout')
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  async logout(@Request() req: any) {
    const userId = req.user.userId;

    // In a real implementation, you would:
    // 1. Add token to blacklist
    // 2. Clear session data
    // 3. Log the logout event

    return {
      success: true,
      message: 'Logout successful',
    };
  }
}
