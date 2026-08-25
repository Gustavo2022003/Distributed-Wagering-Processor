import { Test, TestingModule } from '@nestjs/testing';
import { WageringService } from './wagering.service';

describe('WageringService', () => {
  let service: WageringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WageringService],
    }).compile();

    service = module.get<WageringService>(WageringService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
