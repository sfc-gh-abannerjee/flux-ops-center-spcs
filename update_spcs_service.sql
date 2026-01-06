-- Update FLUX_OPS_CENTER service with latest image
-- Run this after pushing the new Docker image

USE SCHEMA SI_DEMOS.APPLICATIONS;

-- Check current service status
SHOW SERVICES IN SCHEMA SI_DEMOS.APPLICATIONS;

-- Suspend service before update
ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER SUSPEND;

-- Wait 10 seconds for graceful shutdown
SELECT SYSTEM$WAIT(10);

-- Resume with new image (SPCS will pull latest tag)
ALTER SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER RESUME;

-- Monitor service startup
CALL SYSTEM$GET_SERVICE_STATUS('SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER');

-- Check logs for startup
CALL SYSTEM$GET_SERVICE_LOGS('SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER', 0, 'frontend', 100);

-- Get public endpoint
SHOW ENDPOINTS IN SERVICE SI_DEMOS.APPLICATIONS.FLUX_OPS_CENTER;
