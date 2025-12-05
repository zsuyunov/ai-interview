import AgentWrapper from "@/components/AgentWrapper";
import { getCurrentUser } from "@/lib/actions/auth.action";

const Page = async () => {
  const user = await getCurrentUser();

  return (
    <>
      <h3>Interview generation</h3>

      <AgentWrapper
        userName={user?.name!}
        userId={user?.id}
        type="generate"
      />
    </>
  );
};

export default Page;
