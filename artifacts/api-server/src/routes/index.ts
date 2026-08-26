import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nurseryRouter from "./nursery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nurseryRouter);

export default router;
