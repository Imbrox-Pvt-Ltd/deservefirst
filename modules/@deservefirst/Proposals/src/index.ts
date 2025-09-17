import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ABCService } from './services/ABC.service';
import { XYZService } from './services/XYZ.service';
import { ANFService } from './services/ANF.service';
import { ANFService } from './services/ANF.service';
import { AKIService } from './services/AKI.service';
import { AJKService } from './services/AJK.service';
import { KLRService } from './services/KLR.service';
import { AKDService } from './services/AKD.service';
import { AKLOService } from './services/AKLO.service';
import { KLService } from './services/KL.service';



@Module({
  imports: [
    TypeOrmModule.forFeature([
      
    ]),
  ],
  controllers: [
    
  ],
  providers: [
    ABCService,
    XYZService,
    ANFService,
    ANFService,
    AKIService,
    AJKService,
    KLRService,
    AKDService,
    AKLOService,
    KLService
  ],
  exports: [
    ABCService,
    XYZService,
    ANFService,
    ANFService,
    AKIService,
    AJKService,
    KLRService,
    AKDService,
    AKLOService,
    KLService
  ],
})
export class ProposalsModule {}
