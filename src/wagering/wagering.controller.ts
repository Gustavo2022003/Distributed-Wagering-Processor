import { Controller } from '@nestjs/common';
import { WageringService } from './wagering.service';

@Controller('wagering')
export class WageringController {
  constructor(private readonly wageringService: WageringService) {}
}
