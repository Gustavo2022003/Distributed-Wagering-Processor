import { Test, TestingModule } from '@nestjs/testing';
import { WageringController } from './wagering.controller';
import { WageringService } from './wagering.service';

describe('WageringController', () => {
  let controller: WageringController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WageringController],
      providers: [WageringService],
    }).compile();

    controller = module.get<WageringController>(WageringController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
