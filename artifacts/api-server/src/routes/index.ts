import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nurseryRouter from "./nursery";
import applicationsRouter from "./applications";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(applicationsRouter);
router.use(storageRouter);
router.use(nurseryRouter);

export default router;
